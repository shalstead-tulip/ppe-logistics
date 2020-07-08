@isTest
public class TestTulipInstitution {

    @isTest static void CreateTulipInstitution() {

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
                                Delivery_Notes__c = 'something');
        insert a;

        TulipInstitution ti = new TulipInstitution(a);
    }
}
