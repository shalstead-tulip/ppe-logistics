const AWS = require("aws-sdk");
const jsforce = require("jsforce");
const pg = require("pg");
const https = require("https");
const url = require("url");


var SECRETS = {};

function decrypt(env_var) {
  const kms = new AWS.KMS();

  console.log("Decrypting key: " + env_var);
  return kms
    .decrypt({
      CiphertextBlob: new Buffer.from(process.env[env_var], "base64"),
    })
    .promise()
    .then((res) => {
      SECRETS[env_var] = res.Plaintext.toString("ascii");
      return SECRETS[env_var];
    });
}

// Define global variable to store database client
let dbClient;

const sfConn = new jsforce.Connection({
  // uncomment below for sandbox
  loginUrl: process.env.SF_LOGIN_URL,
});

function getDBClient() {
  console.log("CONNECTING TO POSTGRES DB");
  dbClient = new pg.Client({
    host: process.env.PG_HOST,
    port: 5432,
    user: "tulip",
    password: SECRETS.PG_PWD,
    database: process.env.PG_DATABASE,
  });

  dbClient.connect();

  return dbClient;
}

function failureCallback(error) {
  console.error("Error: " + error);
}

let orderRecords;

function orderInfo(i) {
  var record = orderRecords[i];
  return `${record.ccrz__orderstatus__c} - ${record.ccrz__extshiptrackno__c}`;
}

function logResult(rets, i) {
  if (rets[i].success) {
    console.log(`#${i + 1} SUCCESS: sf_id ${rets[i].id} [${orderInfo(i)}]`);
  } else {
    console.log(
      `#${i + 1} ERROR: ${rets[i].errors.join(", ")} [${orderInfo(i)}]`
    );
  }
}

/////////////////////
// Run a bulk insert
/////////////////////
let job;

function batchUpdate(orders) {
  console.log(">>> runBatch");
  // Create job and batch
  console.log("--> Create job and batch");
  job = sfConn.bulk.createJob("ccrz__E_Order__c", "update");
  var batch = job.createBatch();
  // start job
  console.log("--> start job");
  batch.execute(orders);

  return new Promise(function (resolve, reject) {
    batch.on("queue", function (batchInfo) {
      batchId = batchInfo.id;
      var batch = job.batch(batchId);
      batch.on("response", function (res) {
        resolve(res);
      });
      batch.on("error", function (err) {
        reject(err);
      });
      batch.poll(1000, 20 * 1000);
    });
  });
}

function reportResults(rets) {
  // fired when batch finished and result retrieved
  console.log("--> batch finished results retrieved");
  console.log("--> Results:");
  for (var i = 0; i < rets.length; i++) {
    logResult(rets, i);
  }
  console.log("--> close job, logout connection");

  return job
    .close()
    .then((jobInfo) => console.log("--> Job Summary <--\n", jobInfo))
    .then((res) => sfConn.logout());
}

function failedBatch(err) {
  console.log("Error, batchInfo:", err);
}

function saveResults(res) {
  console.log(">>> QUERY RESULTS");
  console.log(res);

  orderRecords = res.rows;

  console.log("--> Records returned by query:");
  console.log(orderRecords);
  return orderRecords;
}

//////////////////////////////
// Main Execution
//////////////////////////////

// Query the product db.
var query_text = `
WITH orders AS
(
	SELECT
		external_identifier,
		FIRST(order_status) AS order_status,
		FIRST(process_status) AS process_status,
		FIRST(t.status) AS transport_status,
		FIRST(t.trackingnumber) AS trackingnumber
	FROM corps.demands d
	LEFT JOIN corps.transport t
		ON d.uid = t.wo
	WHERE org = 'MasksOn'
		AND external_identifier IS NOT NULL
		AND external_identifier NOT IN ('','undefined')
	GROUP BY external_identifier
)
,
sfdc_orders AS
(
	SELECT
		external_identifier AS id,
    trackingnumber AS ccrz__ExtShipTrackNo__c,
    true AS Synced_with_Tulip__c,
		(CASE
			WHEN order_status = 'CART' THEN 'CSR Review'
			WHEN order_status = 'REVIEW' THEN 'CSR Review'
			WHEN order_status = 'CSR-REVIEW' THEN 'CSR Review'
			WHEN order_status = 'OPEN' THEN 'Open'
			WHEN order_status = 'HOLD' THEN 'On Hold'
			WHEN (order_status = 'CLOSED'
					AND process_status = 'DELIVERED'
					AND transport_status = 'DELIVERED')
				THEN 'Shipped'
			WHEN order_status = 'CLOSED' THEN 'Cancelled'
			ELSE 'Open'
		END) AS ccrz__OrderStatus__c
	FROM orders
)
SELECT
  *
FROM sfdc_orders;
`;

exports.handler = async (event, context) => {
  return decrypt("PG_PWD")
    .then((res) => decrypt("SF_PWD"))
    .then((res) => decrypt("SF_SEC_TOK"))
    .then((res) => getDBClient())
    .then((res) => dbClient.query(query_text))
    .then((res) => saveResults(res))
    .then((res) =>
      sfConn.login(process.env.SF_USER, SECRETS.SF_PWD + SECRETS.SF_SEC_TOK)
    )
    .then((res) => batchUpdate(orderRecords))
    .then(reportResults, failedBatch)
    .catch(failureCallback)
    .then((res) => dbClient.end());
};
