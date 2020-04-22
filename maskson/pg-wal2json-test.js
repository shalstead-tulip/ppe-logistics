const jsforce = require("jsforce");
const pg = require("pg");
const Wal2JSONListener = require("node-wal2json");

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

const walOptions = {
  "include-type-oids": 1,
  "include-types": 1,
};

const options = {
  slotName: "test_slot",
  timeout: 500,
};


// Single record update
function updateRecordSFDC(change) {
  let recordType;
  // TODO: fetch sdfc object ID for transport changes
  // May need to restructure w/ Promises to do this
  // Could get this either via PG query or SFDC api
  var recordValues = {
    Id: change.record.sfdc_object_id,
  };

  // "demands" PG table maps to "CC Order" SFDC object
  if (change.table == "demands") {
    recordType = "ccrz__E_Order__c";
    recordValues.ccrz__Note__c = change.record.notes;
    recordValues.tulip_Internal_Order_ID__c = change.record.uid;
    recordValues.tulip_Process_Status__c = change.record.process_status;
    recordValues.tulip_Order_Status__c = change.record.order_status;
  }
  // "transport" PG table also maps to "CC Order" SFDC object
  if (change.table == "transport") {
    recordType = "ccrz__E_Order__c";
    recordValues.ccrz__ExtShipTrackNo__c = change.record.trackingnumber;
    recordValues.tulip_Order_Notes__c = change.record.notes;
    recordValues.tulip_Shipping_Status__c = change.record.status;
  }
  // "workcenters" PG table maps to "Account" SFDC object
  if (change.table == "workcenters") {
    recordType = "Account";
    recordValues.Delivery_Notes__c = change.record.notes;
  }

  console.log(
    `--> Syncing Tulip '${change.table}' record to Salesforce '${recordType}'`
  );
  console.log(JSON.stringify(recordValues, null, 2));

  sfConn.sobject(recordType).update(recordValues, function (err, ret) {
    if (err || !ret.success) {
      return console.error(err, ret);
    }
    console.log("--> SFDC RECORD UPDATED");
  });
}

var synced_tables = ["demands", "transport", "workcenters"];

function filterEvent(change) {
  var filters = {
    kind: change.kind == "update",
    schema: change.schema == "corps",
    table: synced_tables.includes(change.table),
    org: change.record.org == "MasksOn",
    // check that this isn't a change sycned from SFDC
    sfdc_update: change.record.updated_at != change.record.updated_by_sfdc_at,
    sfdc_object: change.record.sfdc_object_id != null,
    failed: [],
  };

  for (let k of Object.keys(filters)) {
    if (!filters[k]) {
      filters.failed.push(k);
    }
  }
  console.log("--> Filters: ", JSON.stringify(filters, null, 2));
  return filters;
}

function processChangeSet(changeSet) {
  //console.log("--> changeSet ", i, ": ", JSON.stringify(changeSet, null, 2));
  for (j in changeSet) {
    var change = changeSet[j];
    console.log("--> changeSet", i, ", change", j, ":");
    // console.log("Full record:\n", JSON.stringify(change, null, 2)); // log full change
    console.log(
      ` kind: ${change.kind}\n schema: ${change.schema}\n table: ${change.table}`
    );

    // key-value pair column names and values of record
    change.record = {};
    change.columnnames.forEach(
      (key, i) => (change.record[key] = change.columnvalues[i])
    );

    // Event filters
    var filters = filterEvent(change);

    if (filters.failed.length == 0) {
      console.log(">>> SYNC CHANGE TO SFDC");
      updateRecordSFDC(change);
    } else {
      console.log(">>> IGNORED EVENT");
      console.log("--> Did not pass filters:", filters.failed);
    }
  }
}

function handleInboundChangeSets(changeSets) {
  if (changeSets.length > 0) {
    console.log(">>> INBOUND CHANGESETS FROM POSTGRES");
    //console.log(changeSets);
    for (i in changeSets) {
      processChangeSet(JSON.parse(changeSets[i][2]).change);
    }
  }
  wal2JSONListener.next();
}

// Set up WAL listener
const wal2JSONListener = new Wal2JSONListener(client, options, walOptions);

wal2JSONListener.on("changes", handleInboundChangeSets);

wal2JSONListener.on("error", function (err) {
  console.log("err: ", err);
});

function failureCallback(error) {
  console.error("Error: " + error);
}

// "Main"
sfConn
  .login(username, password + securityToken)
  .then((res) => console.log(">>> SFDC Connection Authenticated"))
  .then((res) => wal2JSONListener.start())
  .catch(failureCallback);
