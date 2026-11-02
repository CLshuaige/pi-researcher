import {
  Button as AnimatedButton,
  type ButtonProps,
} from '@animate-ui/react/primitives/buttons/button';

export function Button(props: ButtonProps) {
  return <AnimatedButton hoverScale={1} tapScale={0.98} {...props} />;
}
