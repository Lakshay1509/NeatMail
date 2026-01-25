import { PaymentPayload, SubscriptionPayload } from "@/types/dodo";
import { db } from "./prisma";
import { activateWatch, deactivateWatch } from "./gmail";

export async function addSubscriptiontoDb(payload: SubscriptionPayload) {
  try {
    const data = payload.data;

    // Step 1: Handle database operations in transaction
    const subscription = await db.$transaction(async (tx) => {
      const sub = await tx.subscription.upsert({
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
          user_tokens: {
            connect: { clerk_user_id: data.metadata?.clerk_user_id },
          },
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

      await tx.paymentHistory.updateMany({
        where: {
          dodoSubscriptionId: data.subscription_id,
          subscriptionId: null,
        },
        data: {
          subscriptionId: sub.id,
        },
      });

      return sub;
    });

    // Step 2: Handle watch operations outside transaction
    if (data.status === 'active') {
      await handleWatchActivation(data.subscription_id);
    }

    if (data.status === 'expired' || data.status === 'cancelled' || data.status==='failed' || data.status==='on_hold' || data.status==='pending') {
      await handleWatchDeactivation(data.subscription_id);
    }

    return subscription;
  } catch (error) {
    console.error("Error adding subscription to db", error);
    throw error;
  }
}

async function handleWatchActivation(subscriptionId: string): Promise<void> {
  try {
    const response = await activateWatch(subscriptionId);
    
    if (response.success && response.userId) {
      await db.user_tokens.update({
        where: { clerk_user_id: response.userId },
        data: {
          watch_activated: true,
          last_history_id: response.history_id,
          updated_at: new Date(),
        },
      });
    }
  } catch (error) {
   
    console.error("Failed to activate Gmail watch:", error);
    
  }
}

async function handleWatchDeactivation(subscriptionId: string): Promise<void> {
  try {
    const response = await deactivateWatch(subscriptionId);
    
    if (response.success && response.userId) {
      await db.user_tokens.update({
        where: { clerk_user_id: response.userId },
        data: {
          watch_activated: false,
          last_history_id: null,
          updated_at: new Date(),
        },
      });
    }
  } catch (error) {
    
    console.error("Failed to deactivate Gmail watch:", error);
    
  }
}

export async function addPaymenttoDb(
  payload: PaymentPayload,
  retryCount = 0
): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;
  
  try {
    const data = payload.data;

    
    if (data.subscription_id) {
      
      const subscriptionData = await db.subscription.findUnique({
        where: { dodoSubscriptionId: data.subscription_id },
      });

      
      if (!subscriptionData && retryCount < MAX_RETRIES) {
        console.log(
          `Subscription not found, retrying in ${RETRY_DELAY_MS}ms (attempt ${
            retryCount + 1
          }/${MAX_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        return addPaymenttoDb(payload, retryCount + 1);
      }

      
      if (!subscriptionData) {
        console.error(
          `Subscription not found after ${MAX_RETRIES} retries for payment ${data.payment_id}`
        );
        throw new Error(`Subscription ${data.subscription_id} not found`);
      }

     
      const existingPayment = await db.paymentHistory.findUnique({
        where: { dodoPaymentId: data.payment_id },
      });

      if (existingPayment && existingPayment.status === data.status) {
        console.log(`Payment ${data.payment_id} already processed with same status`);
        return;
      }

      
      await db.$transaction(async (tx) => {
        await tx.paymentHistory.upsert({
          where: { dodoPaymentId: data.payment_id },
          update: {
            status: data.status,
            subscriptionId: subscriptionData.id,
            settlementAmount: data.settlement_amount,
            currency: data.currency,
            paymentType: data.payment_method_type ?? '',
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
            user_tokens: {
              connect: { clerk_user_id: data.metadata?.clerk_user_id },
            },
            subscription: {
              connect: { id: subscriptionData.id },
            },
            dodoPaymentId: data.payment_id,
            dodoSubscriptionId: data.subscription_id,
            invoiceId: data.invoice_id,
            checkoutSessionId: data.checkout_session_id,
            amount: data.total_amount,
            settlementAmount: data.settlement_amount,
            currency: data.currency,
            status: data.status,
            paymentType: data.payment_method_type ?? '',
            paymentMethod: data.payment_method,
            errorCode: data.error_code,
            errorMessage: data.error_message,
            cardLastFour: data.card_last_four,
            cardNetwork: data.card_network,
            cardType: data.card_type,
            metadata: data.metadata,
          },
        });
      });
    }
  } catch (error) {
    console.error("Error adding payment to db", error);
    throw error;
  }
}
