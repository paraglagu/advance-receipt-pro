import { render } from "preact";

export default async () => {
  render(<Extension />, document.body);
};

const Extension = () => {
  return (
    <s-tile
      heading="Take advance"
      subheading="Collect an advance payment"
      onClick={() => {
        shopify.action.presentModal();
      }}
    />
  );
};
