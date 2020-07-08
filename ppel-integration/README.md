PPE Logistics Integrations
=====================

The code in this folder was written to support bi-directional integration between [PPE Logistics](https://ppelogistics.org) and other systems such as Salesforce and Shopify.


`ppel-connector`
=====================

Provides an API to the PPEL PostgreSQL database, allowing external services to inject new customer orders into the PPEL system.

Written in Javascript, deployed to AWS as a Node.js serverless Lambda fronted by an API Gateway.


`ppel-to-salesforce`
=====================

Bulk ETL job to sync order status changes and shipping info back to Salesforce.

Written in Javascript, deployed in AWS as a Node.js serverless Lambda scheduled via CloudWatch Events.


`maskson-salesforce-classes`
=====================

Set of Apex classes that collect customer order info and post it to the `ppel-connector` API, enabling an order to be synced to the PPEL system.

Deployed to the [MasksOn](https://maskson.org/) Salesforce instance, manually invoked from the Salesforce Order page by a user, or invoked automatically when Order objects transition status.


`dev-scripts`
=====================

`pg-wal2json-test.js`: Experimental script using the [PostgreSQL write-ahead log](https://www.postgresql.org/docs/current/wal-intro.html) to stream changes to Salesforce.

`sfdc-cometd-test.js`: Experimental script using the [Salesforce Streaming API](https://developer.salesforce.com/docs/atlas.en-us.api_streaming.meta/api_streaming/intro_stream.htm) to stream changes to the PPEL PostgreSQL database.

