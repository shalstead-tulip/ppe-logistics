const jsforce = require("jsforce");
const pg = require("pg");

import { SECRETS } from './local-secrets.js'

// Salesforce Connection Info
const username = "steven.halstead+maskson@tulip.co.tulipdev1";
const password = SECRETS.SF_PWD;
const securityToken = SECRETS.SF_SEC_TOK;

// Postgres Connection Info
const pgClient = new pg.Client({
  host: "maskson-sfdc-dev-poc-db.cliunwsqnhh7.us-east-1.rds.amazonaws.com",
  port: 5432,
  user: "tulip",
  password: SECRETS.PG_PWD,
  database: "maskson_sfdc_dev",
});

const sfConn = new jsforce.Connection({
  // uncomment below for sandbox
  loginUrl: "https://test.salesforce.com",
});

// Single record update
function updateRecordPG(recordChange) {
  console.log(">>> SYNC EVENT TO PG");
  pgClient.query(
    "UPDATE corps.workcenters SET notes = $1, updated_by_sfdc_at = NOW() WHERE sfdc_object_id = $2",
    [
      recordChange.payload.Delivery_Notes__c,
      recordChange.payload.ChangeEventHeader.recordIds[0],
    ],
    (err, res) => {
      console.log(err ? err.stack : res);
    }
  );
}

var synced_objects = ["Account", "Contact"];

function processMessage(message) {
  console.log(JSON.stringify(message, null, 2));

  let filters = {
    object: synced_objects.includes(
      message.payload.ChangeEventHeader.entityName
    ),
    pg_update:
      message.payload.ChangeEventHeader.changeOrigin !=
      "com/salesforce/api/rest/42.0",
  };

  console.log("Filters: ", JSON.stringify(filters, null, 2));

  var filter_errors = [];
  for (let k of Object.keys(filters)) {
    if (!filters[k]) {
      filter_errors.push(k);
    }
  }

  if (filter_errors.length == 0) {
    console.log(">>> EVENT PASSED FILTERS");
    updateRecordPG(message);
  } else {
    console.log(">>> IGNORED EVENT");
    console.log("--> Did not pass filters:", filter_errors);
  }
}

function failureCallback(error) {
  console.error("Error: " + error);
}

pgClient
  .connect()
  .then((res) => sfConn.login(username, password + securityToken))
  .then((res) => console.log(">>> SFDC Connection Authenticated"))
  .then((res) =>
    sfConn.streaming
      .channel("/data/AccountChangeEvent")
      .subscribe(processMessage)
  )
  .catch(failureCallback);
//.then((res) => pgClient.end());
