global class TulipOrderJSON {
    String orderID;
    String externalID;
    String orderStatus;
    String org;
    String notes;
    List<TulipOrderLine> lines;
    TulipInstitution institution;
    TulipCustomer customer;

    public TulipOrderJSON(ccrz__E_Order__c o, TulipInstitution i, TulipCustomer c, List<TulipOrderLine> ols) {
        orderID = o.Name;
        externalID = o.ID;
        orderStatus = o.ccrz__OrderStatus__c;
        org = 'MasksOn';
        notes = o.ccrz__Note__c ;
        institution = i;
        customer = c;
        lines = ols;
    }
}
