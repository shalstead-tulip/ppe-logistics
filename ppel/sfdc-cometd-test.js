const jsforce = require("jsforce");
const pg = require("pg");

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

const syncMap = {
  Account: {
    table: "workcenters",
    fields: {
      ShippingAddress: "address", // TODO: handle addresses
      Delivery_Notes__c: "notes",
      Name: "workcenter",
    },
  },
  Contact: {
    table: "customers",
    fields: {
      MobilePhone: "phone_number",
    },
  },
  ccrz__E_Order__c: {
    table: "demands",
    fields: {
      ccrz__Note__c: "notes",
    },
  },
};

// Single record update
function updateRecordPG(change) {
  console.log(">>> SYNC RECORD UPDATE TO PG");

  const sfObject = change.ChangeEventHeader.entityName;
  const recordMap = syncMap[sfObject];
  const sfID = change.ChangeEventHeader.recordIds[0];

  var fieldsToSet = "";

  for (let [sfField, pgField] of Object.entries(recordMap.fields)) {
    if (change[sfField]) {
      fieldsToSet = fieldsToSet.concat(
        `\n    ${pgField} = '${change[sfField]}',`
      );
    }
  }

  // If no updated fields
  if (fieldsToSet == "") {
    console.log("--> No relevant field changes to sync");
    return;
  }

  const queryText = `UPDATE corps.${recordMap.table}
  SET ${fieldsToSet}
    updated_by_sfdc_at = NOW()
  WHERE sfdc_object_id = '${sfID}'`;

  console.log("--> PG Query:\n", queryText);

  pgClient.query(queryText, (err, res) => {
    console.log(err ? err.stack : res);
  });
}

// Single record create
function createRecordPG(change) {
  console.log(">>> SYNC NEW RECORD TO PG");

  const sfObject = change.ChangeEventHeader.entityName;
  const recordMap = syncMap[sfObject];
  const sfID = change.ChangeEventHeader.recordIds[0];

  var fieldsToSet = "";
  var fieldValues = "";

  for (let [sfField, pgField] of Object.entries(recordMap.fields)) {
    if (change[sfField]) {
      fieldsToSet = fieldsToSet.concat(`${pgField}, `);
      fieldValues = fieldValues.concat(`'${change[sfField]}', `);
    }
  }

  const queryText = `INSERT INTO corps.${recordMap.table}
  (${fieldsToSet}updated_by_sfdc_at, sfdc_object_id)
  VALUES
  (${fieldValues}NOW(), '${sfID}')`;

  console.log("--> PG Query:\n", queryText);

  pgClient.query(queryText, (err, res) => {
    console.log(err ? err.stack : res);
  });
}

function routeChange(change) {
  const changeType = change.ChangeEventHeader.changeType;
  if (changeType == "UPDATE") {
    updateRecordPG(change);
  } else if (changeType == "CREATE") {
    createRecordPG(change);
  } else if (changeType == "DELETE") {
    // TODO
  } else {
    console.log(`--> Ignoring change of type ${changeType}`);
  }
}

function processMessage(message) {
  console.log(JSON.stringify(message, null, 2));

  let filters = {
    object: Object.keys(syncMap).includes(
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
    routeChange(message.payload);
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
    sfConn.streaming.channel("/data/ChangeEvents").subscribe(processMessage)
  )
  .catch(failureCallback);
//.then((res) => pgClient.end());
