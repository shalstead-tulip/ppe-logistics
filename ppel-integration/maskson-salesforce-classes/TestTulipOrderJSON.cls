@isTest
public class TestTulipOrderJSON {

    @isTest static void CreateTulipOrderJSON() {

        Test.setMock(HttpCalloutMock.class, new TulipMockHttpResponseGenerator());

        // CUSTOMER
        Contact c = new Contact(LastName = 'test contact',
                                Affiliation_with_Healthcare_Institution__c = 'PPE Decision Maker',
                                MobilePhone = '123-123-1234',
                                Email = 'hello@maskson.com',
                                Title = 'Surgeon General',
                                If_Affiliation_is_Other_Please_explain__c = 'something');
        insert c;

        TulipCustomer tc = new TulipCustomer(c);

        // INSTITUTION
        Account a = new Account(Name = 'test account',
                                BillingStreet = '123 Bagel St',
                                BillingCity = 'Somerville',
                                BillingState = 'MA',
                                BillingPostalCode = '02143',
                                BillingCountry = 'USA',
								ShippingStreet = '123 Bagel St',
                                ShippingCity = 'Somerville',
                                ShippingState = 'MA',
                                ShippingPostalCode = '02143',
                                ShippingCountry = 'USA',
                                Delivery_Notes__c = 'something'
                                );
        insert a;

        TulipInstitution ti = new TulipInstitution(a);

        // ORDER LINES
        ccrz__E_Product__c p = new ccrz__E_Product__c(
            Name = 'test product',
            ccrz__SKU__c = 'testSKU'
            );
        insert p;

        // ORDER
        ccrz__E_Order__c o = new ccrz__E_Order__c(
            ccrz__OrderStatus__c = 'Open',
            ccrz__Note__c = 'something',
            ccrz__Account__c = a.ID,
            ccrz__Contact__c = c.ID
        );
        insert o;

        ccrz__E_OrderItem__c oi = new ccrz__E_OrderItem__c(
            ccrz__Order__c = o.ID,
            ccrz__Price__c = 1,
            ccrz__SubAmount__c = 1,
            ccrz__Product__c = p.ID,
            ccrz__Quantity__c = 2
            );
        insert oi;

        TulipOrderLine tol = new TulipOrderLine(oi);
        List<TulipOrderLine> tols = new List<TulipOrderLine>();
        tols.add(tol);

        TulipOrderJSON toj = new TulipOrderJSON(o, ti, tc, tols);
    }
}
