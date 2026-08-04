import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Şifremi Unuttum | LoraSayacTakip",
  description: "Kullanıcı parolanızı güvenli şekilde yenileyin",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
