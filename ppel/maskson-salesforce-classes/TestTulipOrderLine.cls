@isTest
public class TestTulipOrderLine {

    @isTest static void CreateTulipOrderLine() {

        ccrz__E_Product__c p = new ccrz__E_Product__c(
            Name = 'test product',
            ccrz__SKU__c = 'testSKU'
        );
        insert p;

        ccrz__E_OrderItem__c oi = new ccrz__E_OrderItem__c(
            ccrz__Order__c = 'a1c2i0000005LHlAAM',
            ccrz__Price__c = 1,
            ccrz__SubAmount__c = 1,
            ccrz__Product__c = p.ID,
            ccrz__Quantity__c = 2
            );
        insert oi;

        TulipOrderLine tol = new TulipOrderLine(oi);
    }
}
