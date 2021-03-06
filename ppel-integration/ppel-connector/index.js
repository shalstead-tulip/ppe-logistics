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

// Global variable for environment: either DEV or PROD
let env;

// Global variable for API resource/endpoint
let endpoint;

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
  console.log(">>> GET POSTGRES DB CLIENT");
  if (env == "DEV") {
    console.log("CONNECTING TO DEV DB");
    dbClient = new pg.Client({
      host: process.env.PG_HOST_DEV,
      port: process.env.PG_PORT_DEV,
      user: process.env.PG_USER_DEV,
      password: pwd,
      database: process.env.PG_DATABASE_DEV,
    });
  } else if (env == "PROD") {
    console.log("CONNECTING TO PROD DB");
    dbClient = new pg.Client({
      host: process.env.PG_HOST_PROD,
      port: process.env.PG_PORT_PROD,
      user: process.env.PG_USER_PROD,
      password: pwd,
      database: process.env.PG_DATABASE_PROD,
    });
  }

  dbClient.connect();

  return dbClient;
}

// Sanitize text for SQL insert (handle single quotes)
function sanitize(field) {
  // check if field value is a non-null string
  if (field && typeof field == "string") {
    return field.replace("'", "''");
  }
  return field;
}

function formattedAddr(address) {
  if (!address) {
    return "NULL";
  }
  if (!address.formatted_address) {
    return `'${sanitize(address)}'`;
  }
  return `'${sanitize(address.formatted_address)}'`;
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

function tulipId(email) {
  return `'LAMBDA-' || '${email}'`;
}

function buildCustomerQuery(i, c) {
  return `
  INSERT INTO corps.customers (tulipid)
    VALUES (${tulipId(c.email)})
  ON CONFLICT DO NOTHING;
  UPDATE corps.customers SET
    affiliation = '${c.affiliation}',
    email = '${c.email}',
    fullname = '${c.fullName}',
    hospital = '${i.name}',
    hospital_address = ${formattedAddr(i.address)},
    phone_number = '${c.phone}',
    notes = '${c.notes}',
    legalaccept = '${c.legalStatus}',
    delivery_address = ${formattedAddr(c.address)}
  WHERE tulipid = ${tulipId(c.email)};
  `;
}

// Build upsert query for single address
function addrQuery(a, name, email) {
  return `
  INSERT INTO corps.addresses (hospital, tulipid, address, address_loc, latlong)
  SELECT
    '${name}', ${tulipId(email)}, ${formattedAddr(a)},
    ${pointLoc(a)}, ${latlong(a)}
  WHERE NOT EXISTS (
    SELECT tulipid FROM corps.addresses
    WHERE tulipid = ${tulipId(email)}
      AND hospital = '${name}'
      AND address = ${formattedAddr(a)}
  );`;
}

function buildAddressesQuery(i, c) {
  var addrs = [i.address, i.deliveryAddress, c.address];
  var queries = [];
  for (a of addrs) {
    if (a) {
      queries.push(addrQuery(a, i.name, c.email));
    }
  }

  return queries.join("");
}

function buildWorkcenterQuery(o, i, c) {
  return `
  INSERT INTO corps.workcenters (workcenter, wcname, createdts)
    VALUES ('${i.name}', '${i.name}', NOW())
  ON CONFLICT DO NOTHING;
  UPDATE corps.workcenters SET
    address = ${formattedAddr(i.address)},
    loc = ${pointLoc(i.address)},
    latlong = ${latlong(i.address)},
    wcgroup = 'Clinician',
    notes = '${i.notes}',
    org = '${o.org}',
    status = 'OPEN'
  WHERE workcenter = '${i.name}';
  `;
}

function buildDemandQuery(o, i, c) {
  var queries = [];
  for (j = 0; j < o.lines.length; j++) {
    var l = o.lines[j];
    const q = `
    INSERT INTO corps.demands (orderid, orderline, createdts, org,
        external_identifier, wolocation, process_status)
      VALUES('${o.orderID}', ${j + 1}, NOW(), '${o.org}',
        '${o.externalID}', 'BACKLOG', 'BACKLOG')
    ON CONFLICT DO NOTHING;
    UPDATE corps.demands SET
      product = '${l.product}',
      demandcenter = '${i.name}',
      qty = '${l.quantity}',
      notes = '${o.notes}',
      order_status = '${o.orderStatus}',
      alt_user = ${tulipId(c.email)},
      alt_address = ${formattedAddr(i.deliveryAddress)},
      alt_loc = ${pointLoc(i.deliveryAddress)}
    WHERE orderid = '${o.orderID}'
      AND orderline = ${j + 1}
      AND org = '${o.org}'
      AND external_identifier = '${o.externalID}';
      `;
    queries.push(q);
  }
  return queries.join("");
}

function syncOrder(o) {
  console.log(">>> SYNC NEW RECORD TO PG");
  console.log("--> Prepped order:\n" + JSON.stringify(o, null, 2));

  // Sanitize notes and names for SQL insert (handle single quotes)
  o.notes = sanitize(o.notes);
  o.institution.name = sanitize(o.institution.name);
  o.institution.notes = sanitize(o.institution.notes);
  o.customer.notes = sanitize(o.customer.notes);

  const i = o.institution;
  const c = o.customer;

  let upsertCustomer;
  let upsertAddresses;
  let upsertWorkcenter;
  let upsertDemands;

  try {
    // CUSTOMERS
    upsertCustomer = buildCustomerQuery(i, c);
    console.log("--> UPSERT CUSTOMER:", upsertCustomer);

    // ADDRESSES
    upsertAddresses = buildAddressesQuery(i, c);
    console.log("--> UPSERT ADDRESSES:", upsertAddresses);

    // WORKCENTERS
    upsertWorkcenter = buildWorkcenterQuery(o, i, c);
    console.log("--> UPSERT WORKCENTER:", upsertWorkcenter);

    // DEMANDS
    // TODO: default order_status to CSR-REVIEW if not provided
    upsertDemands = buildDemandQuery(o, i, c);
    console.log("--> UPSERT DEMANDS:", upsertDemands);
  } catch (err) {
    throw `FAILED QUERY BUILDING DUE TO: ${err}`;
  }

  return dbClient
    .query("BEGIN")
    .then((res) => dbClient.query(upsertCustomer))
    .then((res) => dbClient.query(upsertAddresses))
    .then((res) => dbClient.query(upsertWorkcenter))
    .then((res) => dbClient.query(upsertDemands))
    .then((res) => dbClient.query("COMMIT"))
    .then((res) => {
      return "ORDER SYNC SUCCESS";
    })
    .catch((err) => {
      dbClient.query("ROLLBACK");
      throw { type: "ORDER SYNC FAILED", error: err };
    });

  // Test Query for validating PROD/DEV DB connections
  // return dbClient.query("SELECT * FROM corps.demands ORDER BY createdts DESC NULLS LAST LIMIT 1");
}

// Helper function to "flatten" address objects
function flattenA(a) {
  if (!a) {
    return a;
  }
  let aFlat;
  if (endpoint == "/order/shopify") {
    aFlat = `${a.address1} ${a.address2}, ${a.city}, ${a.province_code} ${a.zip} ${a.country_code}`;
  } else {
    aFlat = `${a.street}, ${a.city}, ${a.state} ${a.postalCode} ${a.country}`;
  }
  return aFlat.replace("null", "");
}

function parseSFAddresses(o) {
  console.log("--> Reformatting addresses for order from Salesforce");
  o.institution.address = flattenA(o.institution.address);
  o.institution.deliveryAddress = flattenA(o.institution.deliveryAddress);
  return o;
}

// Map Salesforce product SKUs to PPEL product SKUs
const sfdcSKUMap = {
  MaskSM00001: "PPE S/M v2",
  MaskSM00002: "PPE S/M v2",
  MaskLXL00001: "PPE L/XL v2",
  MaskLX00002: "PPE L/XL v2",
};

function mapSFProductSKUs(o) {
  console.log("--> Mapping Salesforce product SKUs to PPEL product SKUs");
  for (i = 0; i < o.lines.length; i++) {
    o.lines[i].product = sfdcSKUMap[o.lines[i].product];
  }
  return o;
}

// Map Salesforce order statuses to PPEL order statuses
const sfdcOrderStatusMap = {
  "CSR Review": "CSR-REVIEW",
  Open: "OPEN",
  "Order Submitted": "OPEN",
  "Cancel Submitted": "CLOSED",
  Cancelled: "CLOSED",
  Completed: "CLOSED",
  Shipped: "CLOSED",
  "Return Submitted": "OPEN",
  Returned: "CLOSED",
  "In Process": "OPEN",
  "Partial Shipped": "OPEN",
  "Bill Of Material": "OPEN",
  "On Hold": "HOLD",
};

function parseShopifyLines(lines) {
  var newLines = [];
  for (l of lines) {
    const newL = {
      product: l.sku,
      quantity: l.quantity,
    };
    newLines.push(newL);
  }
  return newLines;
}

function parseShopifyOrder(o) {
  console.log(">>> Parsing order from Shopify");

  const orderOrg = o.line_items[0].vendor;

  var newOrder = {
    externalID: o.id,
    orderID: `SHOP-${orderOrg}-${o.order_number}`,
    orderStatus: "OPEN", // should it come in as OPEN or CSR-REVIEW?
    org: orderOrg, // assume vendor is same for all lines
    notes: o.note,
    institution: {
      name: o.customer.default_address.company,
      address: flattenA(o.billing_address),
      deliveryAddress: flattenA(o.shipping_address),
      notes: "",
    },
    customer: {
      address: flattenA(o.customer.default_address),
      fullName: o.customer.first_name + " " + o.customer.last_name,
      affiliation: "",
      phone: o.customer.phone,
      email: o.customer.email,
      notes: o.customer.note,
      legalStatus: "OPEN", //should this be OPEN? or something else?
    },
    lines: parseShopifyLines(o.line_items),
  };

  console.log(`--> Parsed Order:\n${JSON.stringify(newOrder, null, 2)}`);

  return newOrder;
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

function fetchAddress(entity, addrField) {
  console.log(`--> Try to fetch geoinfo for field "${addrField}" on entity`);
  console.log(JSON.stringify(entity, null, 2));

  var rawAddress = entity[addrField];

  if (rawAddress == null) {
    console.log(`--> Address is null, exiting early`);
    return Promise.resolve(null);
  }

  if (typeof rawAddress == "object") {
    console.log(`--> Address is an object, attempting to flatten`);
    try {
      rawAddress = flattenA(rawAddress);
    } catch (err) {
      console.log("--> Failed to flatten address, throwing error");
      throw "INVALID ADDRESS FORMAT";
    }
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
function enrichAddresses(o) {
  console.log(">>> ENRICH ADDRESSES VIA GEOCODE API");
  return fetchAddress(o.institution, "address")
    .then((addr) => {
      o.institution.address = addr;
    })
    .then((res) => fetchAddress(o.institution, "deliveryAddress"))
    .then((addr) => {
      o.institution.deliveryAddress = addr;
    })
    .then((res) => fetchAddress(o.customer, "address"))
    .then((addr) => {
      o.customer.address = addr;
    })
    .then((res) => {
      return o;
    });
}

// Returns a url that points to the log link of this particular invocation
function getLogURL() {
  return `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logEventViewer:group=${podContext.logGroupName};stream=${podContext.logStreamName}`;
}

function postToSlack(res) {
  const m = "`"; // monospace
  const b = "```"; // code block
  var msg = `*ERROR FROM PPEL CONNECTOR LAMBDA - ${env}*
  ${m}resource: ${endpoint}${m}
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
  // Try to fail gracefully
  try {
    console.error("Error: " + JSON.stringify(error, null, 2));
    var response = {
      statusCode: 500,
      body: JSON.stringify(
        { summary: "Internal Server Error", error: error },
        null,
        4
      ),
      isBase64Encoded: false,
    };

    // Shopify endpoint is being hit with a webhook that expects a 200 response,
    // otherwise it will retry sending repeatedly
    if (endpoint == "/order/shopify") {
      response.statusCode = 200;
    }

    return postToSlack(response);
  } catch (err) {
    // fallback "rough" failure
    console.log(`>>> FAILED TO FAIL GRACEFULLY DUE TO:\n${err}`);
    throw err;
  }
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

// TODO: encrypt google API key
exports.handler = async (event, context) => {
  try {
    console.log("NEW EVENT:", event);
    console.log();
    podContext = context;
    endpoint = event.resource;

    env = event.stageVariables.environment;

    if (
      endpoint == "/order" &&
      "Bearer " + process.env["AUTH_TOKEN_" + env] !=
        event.headers.Authorization
    ) {
      return failureCallback("Invalid bearer token");
    }

    var order = JSON.parse(event.body);

    if (endpoint == "/order/salesforce") {
      order = parseSFAddresses(order);
      order = mapSFProductSKUs(order);
      order.orderStatus = sfdcOrderStatusMap[order.orderStatus];
    }

    if (endpoint == "/order/shopify") {
      order = parseShopifyOrder(order);
    }

    return decrypt("PG_PWD_" + env)
      .then((pwd) => getDBClient(pwd, env))
      .then((res) => enrichAddresses(order))
      .then((o) => syncOrder(o))
      .then((res) => successCallback(res))
      .catch((error) => failureCallback(error));
  } catch (err) {
    console.log(">>> UNEXPECTED ERROR RUNNING LAMBDA");
    return failureCallback(err);
  }
};
