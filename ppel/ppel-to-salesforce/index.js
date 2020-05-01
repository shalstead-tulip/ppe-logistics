const jsforce = require("jsforce");
const pg = require("pg");

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

// Global variable for environment: either DEV or PROD
const env = "DEV";

// Salesforce Connection Info
const SF_USER = "steven.halstead+maskson@tulip.co.tulipdev1";

const sfConn = new jsforce.Connection({
  // uncomment below for sandbox
  loginUrl: "https://test.salesforce.com",
});

function getDBClient() {
  console.log("CONNECTING TO DEV DB");
  dbClient = new pg.Client({
    host: "maskson-sfdc-dev-poc-db.cliunwsqnhh7.us-east-1.rds.amazonaws.com",
    port: 5432,
    user: "tulip",
    password: SECRETS.PG_PWD,
    database: "maskson_sfdc_dev",
  });

  dbClient.connect();

  return dbClient;
}

function failureCallback(error) {
  console.error("Error: " + error);
}

let orderRecords;

let jobResults;

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

function batchUpsert(orders) {
  console.log(">>> runBatch");
  // Create job and batch
  console.log("--> Create job and batch");
  var job = sfConn.bulk.createJob("ccrz__E_Order__c", "update");
  var batch = job.createBatch();
  // start job
  console.log("--> start job");
  batch.execute(orders);
  // listen for events
  console.log("--> listen for events");
  batch.on("error", function (batchInfo) {
    // fired when batch request is queued in server.
    console.log("Error, batchInfo:", batchInfo);
  });
  batch.on("queue", function (batchInfo) {
    // fired when batch request is queued in server.
    console.log("queue, batchInfo:", batchInfo);
    batch.poll(1000 /* interval(ms) */, 20000 /* timeout(ms) */); // start polling - Do not poll until the batch has started
  });
  batch.on("response", function (rets) {
    // fired when batch finished and result retrieved
    console.log("--> batch finished results retrieved");
    jobResults = rets;
    console.log("--> Results:");
    for (var i = 0; i < rets.length; i++) {
      logResult(rets, i);
    }
    console.log("--> close job, logout connection");
    job
      .close()
      .then((jobInfo) => console.log("--> Job Summary <--\n", jobInfo))
      .then((res) => sfConn.logout());
  });
}

function saveRecords(records) {
  orderRecords = records;
  return orderRecords;
}

function printRecordsRaw() {
  console.log(orderRecords);
  return;
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

console.log(query_text);

function fetchAndLoad() {
  getDBClient();
  dbClient
    .query(query_text)
    .then((res) => saveRecords(res.rows))
    .then((res) => printRecordsRaw())
    .then((res) =>
      sfConn.login(process.env.SF_USER, SECRETS.SF_PWD + SECRETS.SF_SEC_TOK)
    )
    .then((res) => batchUpsert(orderRecords))
    .catch(failureCallback)
    .then((res) => dbClient.end());
}

exports.handler = async (event, context) => {
  return fetchAndLoad();
};
