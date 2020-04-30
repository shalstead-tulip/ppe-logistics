const AWS = require("aws-sdk");
const pg = require("pg");
const { WebClient } = require("@slack/web-api");
const https = require("https");
const url = require("url");

const slack = new WebClient(process.env.SLACK_TOKEN);

// Define context as a global variable for the pod to make getting logs easier
let podContext;

// Define global variable to store database client
let dbClient;

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

function formattedAddr(address) {
  if (!address) {
    return "NULL";
  }
  if (!address.formatted_address) {
    return `'${address}'`;
  }
  return `'${address.formatted_address}'`;
}

function pointLoc(address) {
  if (!address) {
    return "NULL";
  }
  if (!address.lat) {
    return "NULL";
  }
  return `'POINT (${address.long} ${address.lat})'`;
}

function latlong(address) {
  if (!address) {
    return "NULL";
  }
  if (!address.lat) {
    return "NULL";
  }
  return `'${address.lat},${address.long}'`;
}

// Format values for insert to addresses table
function addrValues(a, name, email) {
  return `(${formattedAddr(a)},${pointLoc(a)},${latlong(
    a
  )},'${name}','LAMBDA-' || '${email}')`;
}

function buildCustomerQuery(i, c) {
  return `
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
    '${c.affiliation}',
    '${c.email}',
    '${c.fullName}',
    '${i.name}',
    ${formattedAddr(i.address)},
    '${c.phone}',
    '${c.notes}',
    'LAMBDA-' || '${c.email}',
    '${c.legalStatus}',
    ${formattedAddr(c.address)}
  )`;
}

function buildAddressQuery(i, c) {
  var addrs = [i.address, i.deliveryAddress, c.address];
  var values = [];
  for (a of addrs) {
    if (a) {
      values.push(`${addrValues(a, i.name, c.email)}`);
    }
  }

  return `
  INSERT INTO corps.addresses (
    address,
    address_loc,
    latlong,
    hospital,
    tulipid
  )
  VALUES
  ${values.join(",\n")}`;
}

function buildWorkcenterQuery(o, i, c) {
  return `
  INSERT INTO corps.workcenters (
    address,
    loc,
    latlong,
    workcenter,
    wcgroup,
    notes,
    org,
    status,
    createdts
  )
  VALUES (
    ${formattedAddr(i.address)},
    ${pointLoc(i.address)},
    ${latlong(i.address)},
    '${i.name}',
    'Clinician',
    '${i.notes}',
    '${o.org}',
    'OPEN',
    NOW()
  )`;
}

function buildDemandQuery(o, i, c) {
  var values = [];
  for (j = 0; j < o.lines.length; j++) {
    var l = o.lines[j];
    var line = `
    (
      '${o.orderID}',
      ${j + 1},
      '${l.product}',
      '${i.name}',
      '${l.quantity}',
      NOW(),
      '${o.notes}',
      '${o.orderStatus}',
      '${o.org}',
      '${o.externalID}',
      'BACKLOG',
      'BACKLOG',
      'LAMBDA-' || '${c.email}',
      ${formattedAddr(i.deliveryAddress)},
      ${pointLoc(i.deliveryAddress)}
    )`;
    values.push(line);
  }
  return `
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
    alt_address,
    alt_loc
  )
  VALUES
  ${values.join(",")}`;
}

function createOrder(o) {
  console.log(">>> SYNC NEW RECORD TO PG");
  console.log("--> Prepped order:\n" + JSON.stringify(o, null, 2));

  // TODO: run this sanitization on all strings
  o.institution.name = o.institution.name.replace("'", "''");

  const i = o.institution;
  const c = o.customer;

  let insertCustomer;
  let insertAddresses;
  let insertWorkcenter;
  let insertDemands;

  try {
    // CUSTOMERS
    insertCustomer = buildCustomerQuery(i, c);
    console.log("--> CREATE CUSTOMER:", insertCustomer);

    // ADDRESSES
    insertAddresses = buildAddressQuery(i, c);
    console.log("--> CREATE ADDRESS:", insertAddresses);

    // WORKCENTERS
    insertWorkcenter = buildWorkcenterQuery(o, i, c);
    console.log("--> CREATE WORKCENTER:", insertWorkcenter);

    // DEMANDS
    // TODO: default order_status to CSR-REVIEW if not provided
    insertDemands = buildDemandQuery(o, i, c);
    console.log("--> CREATE DEMANDS:", insertDemands);
  } catch (err) {
    throw `FAILED QUERY BUILDING DUE TO: ${err}`;
  }

  return dbClient
    .query("BEGIN")
    .then((res) => dbClient.query(insertCustomer))
    .then((res) => dbClient.query(insertAddresses))
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

// Returns a url that points to the log link of this particular invocation
function getLogURL() {
  return `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logEventViewer:group=${podContext.logGroupName};stream=${podContext.logStreamName}`;
}

function postToSlack(res) {
  const m = "`"; // monospace
  const b = "```"; // code block
  var msg = `*ERROR FROM PPEL CONNECTOR LAMBDA*
  ${m}statusCode: ${res.statusCode}${m} ${b}${res.body}${b}
  _<${getLogURL()}|Cloudwatch Logs>_`;
  return slack.chat
    .postMessage({
      channel: process.env.SLACK_CHANNEL,
      text: msg,
    })
    .then((r) => res)
    .catch((e) => res);
}

function failureCallback(error) {
  console.error("Error: " + JSON.stringify(error, null, 2));
  const response = {
    statusCode: 500,
    body: JSON.stringify(
      { summary: "Internal Server Error", error: error },
      null,
      4
    ),
    isBase64Encoded: false,
  };

  return postToSlack(response);
}

function successCallback(res) {
  console.log("Result: " + JSON.stringify(res, null, 2));
  const response = {
    statusCode: 200,
    body: JSON.stringify({ summary: "Success", result: res }, null, 2),
    isBase64Encoded: false,
  };

  return response;
}

// Helper function to "flatten" salesforce address objects
function flattenA(a) {
  if (!a) {
    return a;
  }
  return `${a.street}, ${a.city}, ${a.state} ${a.postalCode} ${a.country}`.replace(
    "null",
    ""
  );
}

function parseSFAddresses(o) {
  console.log("--> Reformatting addresses for order from Salesforce");
  o.institution.address = flattenA(o.institution.address);
  o.institution.deliveryAddress = flattenA(o.institution.deliveryAddress);
  return o;
}

// Helper function to promise-ify node request functionality
const getContent = function (url) {
  // return new pending promise
  return new Promise((resolve, reject) => {
    // select http or https module, depending on reqested url
    const lib = url.startsWith("https") ? require("https") : require("http");
    const request = lib.get(url, (response) => {
      // handle http errors
      if (response.statusCode < 200 || response.statusCode > 299) {
        reject(
          new Error("Failed to load page, status code: " + response.statusCode)
        );
      }
      // temporary data holder
      const body = [];
      // on every content chunk, push it to the data array
      response.on("data", (chunk) => body.push(chunk));
      // we are done, resolve promise with those joined chunks
      response.on("end", () => resolve(body.join("")));
    });
    // handle connection errors of the request
    request.on("error", (err) => reject(err));
  });
};

function fetchAddress(rawAddress) {
  if (!rawAddress) {
    return null;
  }
  console.log(`--> fetching geo info for address: "${rawAddress}"`);
  const paramAddress = rawAddress.replace(" ", "+");

  const requestUrl = url.parse(
    url.format({
      protocol: "https",
      hostname: "maps.googleapis.com",
      pathname: "/maps/api/geocode/json",
      query: {
        address: paramAddress,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
    })
  );

  const options = {
    hostname: requestUrl.hostname,
    port: 443,
    path: requestUrl.path,
    method: "GET",
  };

  return getContent(requestUrl.href)
    .then((res) => {
      console.log(`--> response: ${res}`);
      const addr = JSON.parse(res).results[0];
      return {
        formatted_address: addr.formatted_address,
        lat: addr.geometry.location.lat,
        long: addr.geometry.location.lng,
      };
    })
    .catch((err) => console.error(err));
}

// Add latitude/longitude to addresses via google geocode API
// TODO: only enriches institution.address, add institution.deliveryAddress and
//   customer.address
function enrichAddresses(o) {
  return fetchAddress(o.institution.address)
    .then((addr) => {
      o.institution.address = addr;
    })
    .then((res) => fetchAddress(o.institution.deliveryAddress))
    .then((addr) => {
      o.institution.deliveryAddress = addr;
    })
    .then((res) => fetchAddress(o.customer.address))
    .then((addr) => {
      o.customer.address = addr;
    })
    .then((res) => {
      return o;
    });
}

// TODO: encrypt google API key
exports.handler = async (event, context) => {
  console.log("NEW EVENT:", event);
  console.log();
  podContext = context;

  const env = event.stageVariables.environment;

  if (
    event.resource == "/order" &&
    "Bearer " + process.env["AUTH_TOKEN_" + env] != event.headers.Authorization
  ) {
    return failureCallback("Invalid bearer token");
  }

  var order = JSON.parse(event.body);

  if (event.resource == "/order/salesforce") {
    order = parseSFAddresses(order);
  }

  return decrypt("PG_PWD_" + env)
    .then((pwd) => getDBClient(pwd, env))
    .then((res) => enrichAddresses(order))
    .then((o) => createOrder(o))
    .then((res) => successCallback(res))
    .catch((error) => failureCallback(error));
};
