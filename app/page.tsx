import { SoloEngine } from "@/components/quiz/solo-engine";
import { mockMicroeconomics } from "@/data/mock-microeconomics";
export default function HomePage() {
  return <SoloEngine pack={mockMicroeconomics} />;
}
