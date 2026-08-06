import StorageAnalysis from "@/components/StorageAnalysis";
import { PageHeader } from "@/components/PageHeader";


const Page = () => {

    return (
        <>
            <PageHeader title="Large emails" />
            <div className="w-full p-4 ">
                <StorageAnalysis />
            </div>
        </>
    )
};

export default Page;
