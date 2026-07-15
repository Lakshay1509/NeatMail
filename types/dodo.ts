export interface SubscriptionPayload {
  business_id: string;
  data: SubscriptionData;
}

export interface SubscriptionData {
  addons: { addon_id: string; quantity: number }[];
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
  /**
   * Null/undefined on one-time payments. SDK types it `string | null` and optional.
   * Guard with `== null` to catch both.
   */
  subscription_id?: string | null;
  invoice_id: string;
  checkout_session_id: string;
  total_amount: number;
  settlement_amount: number;
  currency: string;
  status: string;
  payment_method: string;
  payment_method_type: string | null,
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

export interface RefundPayload{
  business_id: string;
  data: DodoRefundData;
}

export interface DodoRefundData{
  amount : number,
  business_id: string,
  created_at: string,
  currency: string,
  customer: Customer
  is_partial:boolean,
  payload_type:string,
  payment_id:string,
  reason:string,
  refund_id:string,
  status:string
   metadata: {
    clerk_user_id : string
  };

}

export interface DisputePayload {
  business_id: string;
  data: DodoDisputeData;
}

/**
 * No subscription_id on a dispute. Resolve the subscription via PaymentHistory
 * using payment_id.
 */
export interface DodoDisputeData {
  dispute_id: string;
  payment_id: string;
  /** String, not number: DodoPay represents dispute amounts as strings for precision. */
  amount: string;
  currency: string;
}



