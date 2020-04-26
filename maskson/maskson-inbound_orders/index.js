const AWS = require("aws-sdk");
const pg = require("pg");

function decrypt(env_var) {
  const kms = new AWS.KMS();

  console.log("Decrypting key: " + env_var);
  return kms
    .decrypt({
      CiphertextBlob: new Buffer.from(process.env[env_var], "base64"),
    })
    .promise()
    .then((res) => {
      return res.Plaintext.toString("ascii");
    });
}

const test_msg_1 = {
  institution: {
    name: "Test Hospital 1",
    address: "21 Jump St",
    deliveryAddress: "32 Hop Ave",
    deliveryNotes: "Around the back",
    notes: "blanket approved",
  },
  client: {
    fullName: "Test Clinician 1",
    affiliation: "Chief Resident ; Interacting with Patients",
    phone: "123-123-1234",
    email: "test@testhospital1.com",
    notes: "TESTING ; Waiver signed 4/25/2020",
    status: "OPEN",
  },
  lines: [
    {
      product: "PPE S/M v2",
      quantity: "1",
    },
    {
      product: "PPE L/XL v2",
      quantity: "2",
    },
  ],
  salesforceID: "123412341234",
  orderID: "SF0001",
  orderStatus: "OPEN",
  org: "MasksOn",
  notes: "handle with care",
};

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
function createOrder(dbClient, o) {
  console.log(">>> SYNC NEW RECORD TO PG");

  // CUSTOMERS
  const insertCustomer = `
  INSERT INTO corps.customers (
    affiliation,
    email,
    fullname,
    hospital,
    hospital_address,
    phone_number,
    notes,
    tulipid
  )
  VALUES (
    '${o.client.affiliation}',
    '${o.client.email}',
    '${o.client.fullName}',
    '${o.institution.name}',
    '${o.institution.address}',
    '${o.client.phone}',
    '${o.client.notes}',
    '${o.client.email}' || '-INTEGRATION-' || NOW()
  )`;

  // ADDRESSES
  const insertAddress = `
  INSERT INTO corps.addresses (
    address,
    hospital,
    notes,
    tulipid
  )
  VALUES (
    '${o.institution.address}',
    '${o.institution.name}',
    '${o.institution.deliveryNotes}',
    '${o.client.email}' || '-INTEGRATION-' || NOW()
  )`;

  // WORKCENTERS
  const insertWorkcenter = `
  INSERT INTO corps.workcenters (
    address,
    workcenter,
    wcgroup,
    notes,
    org,
    status
  )
  VALUES (
    '${o.institution.address}',
    '${o.institution.name}' || NOW(),
    'Clinician',
    '${o.institution.notes}',
    '${o.org}',
    'OPEN'
  )`;

  // DEMANDS
  var insertDemands = `
  INSERT INTO corps.demands (
    orderid,
    orderline,
    product,
    demandcenter,
    qty,
    createdts,
    notes,
    order_status,
    org
  )
  VALUES`;

  for (i = 0; i < o.lines.length; i++) {
    var l = o.lines[i];
    console.log(l);
    var line = `
    (
      '${o.orderID}',
      ${i + 1},
      '${l.product}',
      '${o.institution.name}',
      '${l.quantity}',
      NOW(),
      '${o.notes}',
      'OPEN',
      '${o.org}'
    )`;
    if (i > 0) {
      insertDemands = `${insertDemands},`;
    }
    insertDemands = `${insertDemands}${line}`;
  }

  console.log("--> CREATE CUSTOMER:", insertCustomer);
  console.log("--> CREATE ADDRESS:", insertAddress);
  console.log("--> CREATE WORKCENTER:", insertWorkcenter);
  console.log("--> CREATE DEMANDS:", insertDemands);

  return dbClient
    .query("BEGIN")
    .then((res) => dbClient.query(insertCustomer))
    .then((res) => dbClient.query(insertAddress))
    .then((res) => dbClient.query(insertWorkcenter))
    .then((res) => dbClient.query(insertDemands))
    .then((res) => dbClient.query("COMMIT"))
    .catch((err) => {
      dbClient.query("ROLLBACK");
      throw { type: "ROLLBACK", error: err };
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
  const response = {
    statusCode: 500,
    body: "Internal Server Error",
    error: error,
  };
  return response;
}

function successCallback(res) {
  console.log("Result: " + res);
  const response = {
    statusCode: 200,
    body: "Success",
    result: res,
  };
  return response;
}

function getDBClient(pwd) {
  dbClient = new pg.Client({
    host: "maskson-sfdc-dev-poc-db.cliunwsqnhh7.us-east-1.rds.amazonaws.com",
    port: 5432,
    user: "tulip",
    password: pwd,
    database: "maskson_sfdc_dev",
  });

  dbClient.connect();

  return dbClient;
}

exports.handler = async (event) => {
  return decrypt("PG_PWD")
    .then((pwd) => getDBClient(pwd))
    .then((dbClient) => createOrder(dbClient, test_msg_1))
    .then((res) => successCallback(res))
    .catch((error) => failureCallback(error));
};
