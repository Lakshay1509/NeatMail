import {
  PaymentPayload,
  SubscriptionPayload,
} from "@/types/dodo";
import { db } from "./prisma";

export async function addSubscriptiontoDb(payload: SubscriptionPayload) {
  try {
    const data = payload.data;

    await db.subscription.upsert({
      where: { dodoSubscriptionId: data.subscription_id },
      update: {
        status: data.status,
        customerEmail: data.customer.email,
        currency: data.currency,
        recurringAmount: data.recurring_pre_tax_amount,
        quantity: data.quantity,
        paymentFrequencyInterval: data.payment_frequency_interval,
        paymentFrequencyCount: data.payment_frequency_count,
        nextBillingDate: new Date(data.next_billing_date),
        previousBillingDate: new Date(data.previous_billing_date),
        cancelAtNextBillingDate: data.cancel_at_next_billing_date,
        metadata: data.metadata || {},
      },
      create: {
        clerkUserId: data.metadata?.clerk_user_id,
        dodoSubscriptionId: data.subscription_id,
        dodoCustomerId: data.customer.customer_id,
        customerEmail: data.customer.email,
        status: data.status,
        productId: data.product_id,
        currency: data.currency,
        recurringAmount: data.recurring_pre_tax_amount,
        quantity: data.quantity,
        paymentFrequencyInterval: data.payment_frequency_interval,
        paymentFrequencyCount: data.payment_frequency_count,
        nextBillingDate: new Date(data.next_billing_date),
        previousBillingDate: new Date(data.previous_billing_date),
        cancelAtNextBillingDate: data.cancel_at_next_billing_date,
        metadata: data.metadata || {},
      },
    });
  } catch (error) {
    console.error("Error adding subscription to db", error);
    throw error;
  }
}

export async function addPaymenttoDb(payload: PaymentPayload) {
  try {
    const data = payload.data;

    const subscriptionData = await db.subscription.findUnique({
      where: { dodoSubscriptionId: data.subscription_id },
    });

    await db.paymentHistory.upsert({
      where: { dodoPaymentId: data.payment_id },
      update: {
        status: data.status,
        settlementAmount: data.settlement_amount,
        currency: data.currency,
        paymentType: data.card_type,
        paymentMethod: data.payment_method,
        errorCode: data.error_code,
        errorMessage: data.error_message,
        cardLastFour: data.card_last_four,
        cardNetwork: data.card_network,
        cardType: data.card_type,
        invoiceId: data.invoice_id,
        checkoutSessionId: data.checkout_session_id,
        metadata: data.metadata,
      },
      create: {
        clerkUserId: data.metadata.clerk_user_id,
        subscriptionId: subscriptionData?.id,
        dodoPaymentId: data.payment_id,
        dodoSubscriptionId: data.subscription_id,
        invoiceId: data.invoice_id,
        checkoutSessionId: data.checkout_session_id,
        amount: data.total_amount,
        settlementAmount: data.settlement_amount,
        currency: data.currency,
        status: data.currency,
        paymentType: data.card_type,
        paymentMethod: data.payment_method,
        errorCode: data.error_code,
        errorMessage: data.error_message,
        cardLastFour: data.card_last_four,
        cardNetwork: data.card_network,
        cardType: data.card_type,
        metadata: data.metadata,
      },
    });
  } catch (error) {
    console.error("Error adding subscription to db", error);
    throw error;
  }
}
