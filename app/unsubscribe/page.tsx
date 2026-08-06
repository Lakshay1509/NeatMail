import EmailStats from "@/components/EmailStats";
import { PageHeader } from "@/components/PageHeader";

const Page = () => {

    return (
        <>
            <PageHeader title="Unsubscribe" />
            <div className="w-full p-4 ">
                <EmailStats />
            </div>
        </>
    )
};

export default Page;
