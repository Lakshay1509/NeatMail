import TrackedEmail from "@/components/TrackedEmail"



const page = () => {
  return (
    <div className="w-full p-4 space-y-6">
        <div className="px-4">
            <h1 className="text-2xl font-bold tracking-tight">All Tracked Mails</h1>
            <p className="text-muted-foreground">
                View all your labelled emails.
            </p>
        </div>
        <TrackedEmail limit={50} dashboard={false}/>
        
    </div>
  )
}

export default page