
import type { Story } from "@ladle/react";
import CassetteTape from "./CassetteTape";

export const Default: Story = () => (
  <div className="p-8 flex items-center justify-center min-h-screen">
    <CassetteTape className="w-48 h-48 text-neon-pink" />
  </div>
);

export const Animated: Story = () => (
  <div className="p-8 flex items-center justify-center min-h-screen">
    <CassetteTape className="w-48 h-48 text-neon-cyan" animated />
  </div>
);

export const Small: Story = () => (
  <div className="p-8 flex items-center justify-center min-h-screen">
    <CassetteTape className="w-12 h-12 text-acid-green" />
  </div>
);
