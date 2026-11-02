import symbol from '../assets/brand/gewu-symbol.svg';
export function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <img src={symbol} alt="" width="30" height="30" />
    </span>
  );
}
