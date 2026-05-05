import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 63 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.38946 37.9092V40.5967H16.2439L8 54.605V56.0008H20.407V53.3133H11.9284L20.0708 39.3049V37.9092H8.38946Z"
        fill="var(--icon-strong-base)"
      />
      <path
        d="M11.1544 15.2918V10.6909H14.72C16.1665 10.6909 17.0978 11.4408 17.0978 12.9914C17.0978 14.5419 16.1665 15.2918 14.72 15.2918H11.1544ZM19.9933 12.9889C19.9933 9.88779 18.0291 8.00098 14.6425 8.00098H8.30963V26.0926H11.1519V17.9769H13.2444L18.3363 26.0926H21.8681L16.4761 17.7713C18.7258 17.1762 19.9909 15.4708 19.9909 12.9889"
        fill="var(--icon-strong-base)"
      />
      <path d="M54.7759 53.4126H41.3215V56.0009H54.7759V53.4126Z" fill="var(--icon-strong-base)" />
      <path
        d="M44.2075 15.2918V10.6909H47.7755C49.222 10.6909 50.1533 11.4408 50.1533 12.9914C50.1533 14.5419 49.222 15.2918 47.7755 15.2918H44.2075ZM53.0465 12.9889C53.0465 9.88779 51.0822 8.00098 47.6956 8.00098H41.3627V26.0926H44.205V17.9769H46.2999L51.3919 26.0926H54.7518L49.5317 17.7713C51.7789 17.1762 53.0465 15.4708 53.0465 12.9889Z"
        fill="var(--icon-strong-base)"
      />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M18 30H6V18H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="var(--icon-base)" />
        <path d="M48 30H36V18H48V30Z" fill="var(--icon-weak-base)" />
        <path d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" fill="var(--icon-base)" />
        <path d="M84 24V30H66V24H84Z" fill="var(--icon-weak-base)" />
        <path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" fill="var(--icon-base)" />
        <path d="M108 36H96V18H108V36Z" fill="var(--icon-weak-base)" />
        <path d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" fill="var(--icon-base)" />
        <path d="M144 30H126V18H144V30Z" fill="var(--icon-weak-base)" />
        <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="var(--icon-strong-base)" />
        <path d="M168 30H156V18H168V30Z" fill="var(--icon-weak-base)" />
        <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="var(--icon-strong-base)" />
        <path d="M198 30H186V18H198V30Z" fill="var(--icon-weak-base)" />
        <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="var(--icon-strong-base)" />
        <path d="M234 24V30H216V24H234Z" fill="var(--icon-weak-base)" />
        <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
