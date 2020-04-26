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

function createOrder(dbClient, o) {
  console.log(">>> SYNC NEW RECORD TO PG");

  // TODO: add call to google geocoding API

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
    tulipid,
    legalaccept,
    delivery_address
  )
  VALUES (
    '${o.customer.affiliation}',
    '${o.customer.email}',
    '${o.customer.fullName}',
    '${o.institution.name}',
    '${o.institution.address}',
    '${o.customer.phone}',
    '${o.customer.notes}',
    'LAMBDA-' || '${o.customer.email}',
    '${o.customer.legalStatus}',
    '${o.customer.address}'
  )`;

  // ADDRESSES
  // TODO: Add all addresses
  var insertAddress = `
  INSERT INTO corps.addresses (
    address,
    hospital,
    tulipid
  )
  VALUES
  ('${o.institution.address}','${o.institution.name}','LAMBDA-' || '${o.customer.email}'),`;

  if (
    o.institution.deliveryAddress &&
    o.institution.deliveryAddress != o.institution.address
  ) {
    insertAddress = `${insertAddress}
    ('${o.institution.deliveryAddress}','${o.institution.name}','LAMBDA-' || '${o.customer.email}'),`;
  }
  insertAddress = `${insertAddress}
    ('${o.customer.address}','${o.institution.name}','LAMBDA-' || '${o.customer.email}')`;

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
    '${o.institution.name}',
    'Clinician',
    '${o.institution.notes}',
    '${o.org}',
    'OPEN'
  )`;

  // DEMANDS
  // TODO: default order_status to CSR-REVIEW if not provided
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
    org,
    external_identifier,
    wolocation,
    process_status,
    alt_user,
    alt_address
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
      '${o.orderStatus}',
      '${o.org}',
      '${o.externalID}',
      'BACKLOG',
      'BACKLOG',
      'LAMBDA-' || '${o.customer.email}',
      '${o.institution.deliveryAddress}'
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
    .then((res) => {
      return "ORDER CREATION SUCCESS";
    })
    .catch((err) => {
      dbClient.query("ROLLBACK");
      throw { type: "ROLLBACK", error: err };
    });

  // Test Query for validating PROD/DEV DB connections
  // return dbClient.query("SELECT * FROM corps.demands ORDER BY createdts DESC NULLS LAST LIMIT 1");
}

function failureCallback(error) {
  console.error("Error: " + JSON.stringify(error, null, 2));
  const response = {
    statusCode: 500,
    body: JSON.stringify({ summary: "Internal Server Error", error: error }),
    isBase64Encoded: false,
  };
  return response;
}

function successCallback(res) {
  console.log("Result: " + JSON.stringify(res, null, 2));
  const response = {
    statusCode: 200,
    body: JSON.stringify({ summary: "Success", result: res }),
    isBase64Encoded: false,
  };
  return response;
}

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
    console.log("CONNECTING TO PROD DB");
    dbClient = new pg.Client({
      host: "three-d-corps-poc-db.cliunwsqnhh7.us-east-1.rds.amazonaws.com",
      port: 5432,
      user: "tulip",
      password: pwd,
      database: "three_d_corps",
    });
  }

  dbClient.connect();

  return dbClient;
}

exports.handler = async (event) => {
  console.log("NEW EVENT:", event);
  const env = event.stageVariables.environment;

  if (
    "Bearer " + process.env["AUTH_TOKEN_" + env] !=
    event.headers.Authorization
  ) {
    return failureCallback("Invalid bearer token");
  }

  return decrypt("PG_PWD_" + env)
    .then((pwd) => getDBClient(pwd, env))
    .then((dbClient) => createOrder(dbClient, JSON.parse(event.body)))
    .then((res) => successCallback(res))
    .catch((error) => failureCallback(error));
};
