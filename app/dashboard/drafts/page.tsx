import DraftEmails from "../components/EmailDrafts"


const page = () => {
  return (
    <div className="w-full p-4 space-y-6">
      <div className="px-6">
            <h1 className="text-2xl font-bold tracking-tight">All Drafts</h1>
            
        </div>
      <DraftEmails/>
    </div>
  )
}

export default page