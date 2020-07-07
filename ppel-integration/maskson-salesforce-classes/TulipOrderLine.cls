global class TulipOrderLine {
    String product;
    Integer quantity;

    public TulipOrderLine(ccrz__E_OrderItem__c i) {
        ccrz__E_Product__c p = [SELECT ccrz__SKU__c FROM ccrz__E_Product__c WHERE ID=:i.ccrz__Product__c];

        product = p.ccrz__SKU__c;
        quantity = integer.valueof(i.ccrz__Quantity__c);
    }
}
