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
    '${o.client.email}'
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
    '${o.client.email}'
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
    '${o.institution.name}',
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
    .then((dbClient) => createOrder(dbClient, event))
    .then((res) => successCallback(res))
    .catch((error) => failureCallback(error));
};
