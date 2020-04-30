global class TulipOrderLine {
    String product;
    Integer quantity;

    public TulipOrderLine(ccrz__E_OrderItem__c i) {
        product = i.ccrz__Product_Name__c;
        quantity = integer.valueof(i.ccrz__Quantity__c);
    }
}
