global class TulipInstitution {
    String name;
    Address address;
    Address deliveryAddress;
    String notes;

    public TulipInstitution(Account a) {
        name = a.Name;
        address = a.BillingAddress;
        deliveryAddress = a.ShippingAddress;
        notes = a.Delivery_Notes__c;
    }
}

// OLD
/*
global class TulipInstitution {
    String name;
    String address;
    String deliveryAddress;
    String notes;

    public TulipInstitution(Account a) {
        name = a.Name;
        address = flattenAddress(a.BillingAddress);
        deliveryAddress = flattenAddress(a.ShippingAddress);
        notes = a.Delivery_Notes__c;
    }

    private String flattenAddress(Address a) {
        String fa = a.getStreet() + ', '
            + a.getCity() + ', '
            + a.getState() + ' '
            + a.getPostalCode();
        if (a.getCountry() != null) {
            fa = fa + ' ' + a.getCountry();
        }
        return fa;
    }
}
*/
