import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { Field } from './field';

type PasswordFieldProps = Omit<ComponentProps<typeof Field>, 'type' | 'trailing'>;

/** A Field with an eye button that switches the input between hidden and plain text. */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={props.id}
          onClick={() => {
            setVisible((v) => !v);
          }}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Icon className="size-[18px]" aria-hidden />
        </button>
      }
    />
  );
}
