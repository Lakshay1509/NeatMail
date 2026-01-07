import TrackedEmail from "../components/TrackedEmail"


const page = () => {
  return (
    <div className="w-full p-4 space-y-6">
        <div className="px-6">
            <h1 className="text-2xl font-bold tracking-tight">All Tracked Mails</h1>
            <p className="text-muted-foreground">
                Manage and view all your tracked emails.
            </p>
        </div>
        <TrackedEmail limit={50} dashboard={false}/>
        <div className="text-[10px] text-gray-400 px-6">
          To respect your privacy the results are limited to 50 results only!
        </div>
    </div>
  )
}

export default page