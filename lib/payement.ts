import { SubscriptionPayload } from "@/types/dodo";
import { db } from "./prisma";

export async function addSubscriptiontoDb(
  payload: SubscriptionPayload
) {
  try {

    const data = payload.data;

    console.log(data);
    
    await db.subscription.upsert({
        where:{dodoSubscriptionId: data.subscription_id},
        update:{
            status:data.status,
            customerEmail:data.customer.email,
            currency:data.currency,
            recurringAmount:data.recurring_pre_tax_amount,
            quantity:data.quantity,
            paymentFrequencyInterval:data.payment_frequency_interval,
            paymentFrequencyCount:data.payment_frequency_count,
            nextBillingDate: new Date(data.next_billing_date),
            previousBillingDate: new Date(data.previous_billing_date),
            cancelAtNextBillingDate: data.cancel_at_next_billing_date,
            metadata:data.metadata || {},
        },
        create:{
            clerkUserId:data.metadata?.clerk_user_id,
            dodoSubscriptionId:data.subscription_id,
            dodoCustomerId:data.customer.customer_id,
            customerEmail:data.customer.email,
            status:data.status,
            productId:data.product_id,
            currency:data.currency,
            recurringAmount:data.recurring_pre_tax_amount,
            quantity:data.quantity,
            paymentFrequencyInterval:data.payment_frequency_interval,
            paymentFrequencyCount:data.payment_frequency_count,
            nextBillingDate: new Date(data.next_billing_date),
            previousBillingDate: new Date(data.previous_billing_date),
            cancelAtNextBillingDate: data.cancel_at_next_billing_date,
            metadata:data.metadata || {},
        }

    })
    
  } catch (error) {
    console.error("Error adding subscription to db",error);
    throw error;
  }
}