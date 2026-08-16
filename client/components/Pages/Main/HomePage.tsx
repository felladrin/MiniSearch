import SearchForm from "@/components/Search/Form/SearchForm";
import MenuButton from "./Menu/MenuButton";

export default function HomePage({
  query,
  updateQuery,
}: {
  query: string;
  updateQuery: (query: string) => void;
}) {
  return (
    <SearchForm
      query={query}
      updateQuery={updateQuery}
      additionalButtons={<MenuButton />}
    />
  );
}
