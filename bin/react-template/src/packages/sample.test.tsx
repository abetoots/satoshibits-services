import { render, screen } from "@testing-library/react";
import { CustomComponent } from "./sample";

describe("CustomComponent", () => {
  it("renders without crashing", () => {
    //Arrange
    render(<CustomComponent sample="Hello" />);

    //Act
    const element = screen.getByText("Hi! I am a custom component: Hello");

    //Assert
    expect(element).toBeInTheDocument();
  });
});
