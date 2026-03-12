import CustomerPortal from "@/components/CustomerPortal"


const page = () => {
  return (
    <div className="w-full  p-6 md:px-10 space-y-6">
      <h1 className="text-2xl font-bold">Billing & Subscription</h1>
      <CustomerPortal/>
    </div>
  )
}

export default page