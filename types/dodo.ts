export interface SubscriptionPayload {
  business_id: string;
  data: SubscriptionData;
}

export interface SubscriptionData {
  addons: unknown[]; // update if addon structure is known
  billing: BillingAddress;
  cancel_at_next_billing_date: boolean;
  cancelled_at: string | null;
  created_at: string;
  currency: string;
  customer: Customer;
  discount_cycles_remaining: number;
  discount_id: string | null;
  expires_at: string | null;
  metadata: {
    clerk_user_id : string
  };
  meters: unknown[]; // update if meter structure is known
  next_billing_date: string;
  on_demand: boolean;
  payload_type: "Subscription";
  payment_frequency_count: number;
  payment_frequency_interval: "Day" | "Week" | "Month" | "Year";
  previous_billing_date: string;
  product_id: string;
  quantity: number;
  recurring_pre_tax_amount : number,
  status : string,
  subscription_id: string,
  subscription_period_count : number,
  subscription_period_interval: string,
  tax_inclusive : boolean,
  trial_period_days : number
}

export interface BillingAddress {
  city: string;
  country: string;
  state: string;
  street: string;
  zipcode: string;
}

export interface Customer {
  customer_id: string;
  email: string;
  name: string;
  phone_number: string | null;
}

export interface PaymentPayload {
  business_id: string;
  data: DodoPaymentData;
}


export interface DodoPaymentData {
  payment_id: string;
  subscription_id: string;
  invoice_id: string;
  checkout_session_id: string;
  total_amount: number;
  settlement_amount: number;
  currency: string;
  status: string;
  payment_method: string;
  payment_method_type: string,
  card_last_four: string | null;
  card_network: string | null;
  card_type: string | null;
  error_code: string | null;
  error_message: string | null;
  customer: Customer;
  metadata: {
    clerk_user_id : string
  };
  created_at: string;
}