@isTest
public class TestTulipOrderLine {

    @isTest static void CreateTulipOrderLine() {

        ccrz__E_Product__c p = new ccrz__E_Product__c(
            Name = 'test product',
            ccrz__SKU__c = 'testSKU'
        );
        insert p;

        // ORDER
        ccrz__E_Order__c o = new ccrz__E_Order__c(
            ccrz__OrderStatus__c = 'CSR Review',
            ccrz__Note__c = 'something'
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
    }
}
