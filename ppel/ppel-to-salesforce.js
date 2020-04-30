const jsforce = require("jsforce");
const pg = require("pg");
const Wal2JSONListener = require("node-wal2json");

const { SECRETS } = require("./local-secrets.js");

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

// Single record update
function updateRecordSFDC(change) {
  const recordMap = syncMap[change.table];
  const recordType = recordMap.object;
  // TODO: fetch sdfc object ID for transport changes
  // May need to restructure w/ Promises to do this
  // Could get this either via PG query or SFDC api
  // Cache these by fetching initial mapping of order IDs to SFDC IDs,
  //  then add to as new orders created
  var recordValues = {
    Id: change.record.sfdc_object_id,
  };

  for (let [pgField, sfField] of Object.entries(recordMap.fields)) {
    recordValues[sfField] = change.record[pgField];
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

function filterEvent(change) {
  var filters = {
    kind: change.kind == "update",
    schema: change.schema == "corps",
    table: Object.keys(syncMap).includes(change.table),
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
  for (change of changeSet) {
    console.log("--> processing change:");
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
    for (c of changeSets) {
      processChangeSet(JSON.parse(c[2]).change);
    }
  }
  wal2JSONListener.next();
}

// Set up WAL listener
const wal2JSONListener = new Wal2JSONListener(pgClient, options, walOptions);

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
