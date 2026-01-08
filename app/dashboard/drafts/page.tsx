import DraftEmails from "../components/EmailDrafts"


const page = () => {
  return (
    <div className="w-full p-4 space-y-6">
      <div className="px-6">
            <h1 className="text-2xl font-bold tracking-tight">All Drafts</h1>
            <p className="text-muted-foreground">
                Manage and view all your drafts.
            </p>
            
        </div>
      <DraftEmails/>
    </div>
  )
}

export default page