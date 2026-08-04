import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Giriş | LoraSayacTakip",
  description: "MASKİ sayaç takip sistemine giriş yapın",
};

export default function SignIn() {
  return <SignInForm />;
}
