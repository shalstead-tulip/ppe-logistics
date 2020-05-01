const jsforce = require("jsforce");
const pg = require("pg");

const { SECRETS } = require("./local-secrets.js");

// Define global variable to store database client
let dbClient;

// Global variable for environment: either DEV or PROD
const env = "DEV";

// Salesforce Connection Info
const SF_USER = "steven.halstead+maskson@tulip.co.tulipdev1";
const SFDC_PWD = SECRETS.SF_PWD;
const securityToken = SECRETS.SF_SEC_TOK;

const sfConn = new jsforce.Connection({
  // uncomment below for sandbox
  loginUrl: "https://test.salesforce.com",
});

function getDBClient(pwd, env) {
  if (env == "DEV") {
    console.log("CONNECTING TO DEV DB");
    dbClient = new pg.Client({
      host: "maskson-sfdc-dev-poc-db.cliunwsqnhh7.us-east-1.rds.amazonaws.com",
      port: 5432,
      user: "tulip",
      password: pwd,
      database: "maskson_sfdc_dev",
    });
  } else if (env == "PROD") {
    // console.log("CONNECTING TO PROD DB");
    // dbClient = new pg.Client({
    //   host: "three-d-corps-poc-db.cliunwsqnhh7.us-east-1.rds.amazonaws.com",
    //   port: 5432,
    //   user: "tulip",
    //   password: pwd,
    //   database: "three_d_corps",
    // });
  }

  dbClient.connect();

  return dbClient;
}

const syncMap = {
  demands: {
    object: "ccrz__E_Order__c",
    fields: {
      notes: "ccrz__Note__c",
      uid: "tulip_Internal_Order_ID__c",
      process_status: "tulip_Process_Status__c",
      order_status: "tulip_Order_Status__c",
    },
  },
  transport: {
    object: "ccrz__E_Order__c",
    fields: {
      notes: "tulip_Order_Notes__c",
      trackingnumber: "ccrz__ExtShipTrackNo__c",
      status: "tulip_Shipping_Status__c",
    },
  },
  workcenters: {
    object: "Account",
    fields: {
      notes: "Delivery_Notes__c",
    },
  },
};

// Map PPEL order statuses to Salesforce order statuses
const ppelOrderStatusMap = {
  CART: "CSR Review",
  REVIEW: "CSR Review",
  "CSR-REVIEW": "CSR Review",
  OPEN: "Open",
  CLOSED: "Cancelled",
  HOLD: "On Hold",
};

function listQueryFields(fieldMap) {
  var fields = "";
  for (let [key, value] of Object.entries(fieldMap)) {
    if (key.includes("date")) {
      fields = fields.concat(
        `to_char(${key}, 'YYYY-MM-DD') || 'T' || to_char(${key}, 'HH:MI:SS.MSZ') AS ${value},\n`
      );
    } else {
      fields = fields.concat(`${key} AS ${value},\n`);
    }
  }
  fields = fields.slice(0, -2);
  return fields;
}

function printResults(res) {
  console.log(res);
}

function printRows(res) {
  console.log(res.rows);
  return res;
}

function printFields(res) {
  res.fields.forEach(function (field) {
    console.log(`"${field.name}": "",`);
  });
}

function failureCallback(error) {
  console.error("Error: " + error);
}

/////////////////////
// Run a bulk insert
/////////////////////
var test_instances_1 = [
  {
    Name: "bagel-1",
    domain__c: "tulip.co",
    deployment_id__c: "11101",
    category__c: "SOIL",
  },
  {
    Name: "bagel-2",
    domain__c: "tulip.co",
    deployment_id__c: "11102",
    category__c: "SOIL",
  },
  {
    Name: "bagel-3",
    domain__c: "tulip.co",
    deployment_id__c: "11103",
    category__c: "SOIL",
  },
];

let orderRecords;

let jobResults;

function instanceInfo(i) {
  var record = instanceRecords[i];
  return `${record.deployment_id__c} - ${record.name}`;
}

function logResult(rets, i) {
  if (rets[i].success) {
    // console.log(`#${(i + 1)} SUCCESS: sf_id = ${rets[i].id} [${instanceInfo(i)}]`);
  } else {
    console.log(
      `#${i + 1} ERROR: ${rets[i].errors.join(", ")} [${instanceInfo(i)}]`
    );
  }
}

function batchUpsert(instances) {
  console.log(">>> runBatch");
  // Create job and batch
  console.log("--> Create job and batch");
  var job = sfConn.bulk.createJob("tulip_instance__c", "upsert", {
    extIdField: "deployment_id__c",
  });
  var batch = job.createBatch();
  // start job
  console.log("--> start job");
  batch.execute(instances);
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

function printOrderInfo(record) {
  console.log(
    `${record.orderid} - ${record.orderline} - ${record.product} - ${record.qty}`
  );
}

function printRecords() {
  console.log("--> ORDERS <--");
  orderRecords.forEach(printOrderInfo);
  return;
}

//////////////////////////////
// Main Execution
//////////////////////////////

// ${listQueryFields(FIELD_MAP)}
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
  getDBClient(SECRETS.PG_PWD, env);
  dbClient
    .query(query_text)
    .then((res) => saveRecords(res.rows))
    .then((res) => printRecordsRaw())
    .then(res => sfConn.login(SF_USER, SECRETS.SF_PWD + SECRETS.SF_SEC_TOK))
    //.then((res) => batchUpsert(instanceRecords))
    .catch(failureCallback)
    .then((res) => dbClient.end());
}

// listQueryFields(FIELD_MAP);
// fetchInstances().then(res => printRecords());
// runBatch();
fetchAndLoad();
