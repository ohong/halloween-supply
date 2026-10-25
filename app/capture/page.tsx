import { PhoneCapture } from "@/components/store/phone-capture";

export const metadata = { title: "Take your photo — Halloween Supply", robots: { index: false, follow: false } };

export default function CapturePage() {
  return <PhoneCapture />;
}
