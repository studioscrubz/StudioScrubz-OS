import { ProposalEditPage } from "@/components/proposals/ProposalEditPage";

export default function Page({params}:{params:Promise<{proposalId:string}>}){
  return params.then(({proposalId})=><ProposalEditPage proposalId={proposalId}/>);
}
