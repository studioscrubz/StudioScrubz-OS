import OrientationInvite from "./OrientationInvite";
export default async function Page({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 return <OrientationInvite token={token}/>;
}
