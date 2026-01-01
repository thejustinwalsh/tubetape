
import type { Story } from "@ladle/react";
import URLInput from "./URLInput";

export const Default: Story = () => (
  <div className="p-8 min-h-screen flex items-center justify-center">
    <div className="w-full max-w-xl">
      <URLInput onSubmit={(url) => console.log("Submitted URL:", url)} />
    </div>
  </div>
);

export const Disabled: Story = () => (
  <div className="p-8 min-h-screen flex items-center justify-center">
    <div className="w-full max-w-xl">
      <URLInput 
        onSubmit={(url) => console.log("Submitted URL:", url)} 
        disabled 
      />
    </div>
  </div>
);
