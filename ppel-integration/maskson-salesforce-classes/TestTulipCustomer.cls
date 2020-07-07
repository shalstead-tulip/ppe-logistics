@isTest
public class TestTulipCustomer {

    @isTest static void CreateTulipCustomer() {

        Contact c = new Contact(LastName = 'test contact',
                                Affiliation_with_Healthcare_Institution__c = 'PPE Decision Maker',
                                MobilePhone = '123-123-1234',
                                Email = 'hello@maskson.com',
                                If_Affiliation_is_Other_Please_explain__c = 'something');
        insert c;

        TulipCustomer tc = new TulipCustomer(c);
    }
}
