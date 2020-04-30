// Classes for JSON object construction

global class TulipOrder {

    private static TulipOrderJSON buildTulipOrder(Id orderId) {
        System.debug('>>> buildTulipOrder');

        ccrz__E_Order__c o = [SELECT ID, Name, ccrz__OrderStatus__c, ccrz__Note__c, ccrz__Account__c, ccrz__Contact__c FROM ccrz__E_Order__c WHERE ID=:orderID];

        Account a = [SELECT Name, BillingAddress, ShippingAddress, Delivery_Notes__c FROM Account WHERE ID=:o.ccrz__Account__c];
        TulipInstitution ti = new TulipInstitution(a);

        Contact c = [SELECT Name, Email, MobilePhone, Title, Affiliation_with_Healthcare_Institution__c, If_Affiliation_is_Other_Please_explain__c, Verified__c FROM Contact WHERE ID=:o.ccrz__Contact__c];
        TulipCustomer tc = new TulipCustomer(c);

        List<ccrz__E_OrderItem__c> oItems = [SELECT ccrz__Product_Name__c, ccrz__Quantity__c  FROM ccrz__E_OrderItem__c WHERE ccrz__Order__c=:o.ID];
        List<TulipOrderLine> tols = new List<TulipOrderLine>();

        for (integer i = 0; i < oItems.size(); i++) {
            TulipOrderLine tol = new TulipOrderLine(oItems[i]);
            tols.add(tol);
        }

        return new TulipOrderJSON(o, ti, tc, tols);
    }

    @future(callout=true)
    public static void pushOrderToTulip(Id orderId) {
        System.debug('>>> pushOrderToTulip');

        TulipOrderJSON po = buildTulipOrder(orderId);

        HttpRequest req = new HttpRequest();
        String TULIP_NAMED_CRED = 'callout:Tulip_Connector';
        req.setEndpoint(TULIP_NAMED_CRED);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(po));

        Http http = new Http();
        HTTPResponse res = http.send(req);
        System.debug(res.getBody());
    }

    @InvocableMethod(label='Push to Tulip' description='Pushes the order and customer info to Tulip for fulfillment' category= 'Order')
    public static void invokePushOrderToTulip(List<ID> orderIds) {
        for (Id i : orderIds) {
      		pushOrderToTulip(i);
    	}
    }
}
