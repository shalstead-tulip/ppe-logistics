global class TulipCustomer {
    //Address address;
    String fullName;
    String affiliation;
    String phone;
    String email;
    String notes;
    String legalStatus;

    public TulipCustomer(Contact c) {
        fullName = c.Name;
        affiliation = c.Title + ' ; ' + c.Affiliation_with_Healthcare_Institution__c;
        phone = c.MobilePhone;
        email = c.Email;
        notes = c.If_Affiliation_is_Other_Please_explain__c;
        legalStatus = 'OPEN';
    }
}
