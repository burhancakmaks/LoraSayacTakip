import SetupForm from "@/components/auth/SetupForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "İlk Kurulum | LoraSayacTakip",
  description: "İlk yönetici hesabını oluşturun",
};

export default function SetupPage() {
  return <SetupForm />;
}
