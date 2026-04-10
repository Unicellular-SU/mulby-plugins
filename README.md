# mulby_plugins

Welcome to the `mulby_plugins` project! This repository is designed to manage and build a collection of plugins for the Mulby platform. Each plugin is contained within its own directory and can be built and packaged automatically using GitHub Actions.

## Project Structure

- **plugins/**: Contains all the individual plugins.
  - **plugin-1/**: Directory for the first plugin.
  - **plugin-2/**: Directory for the second plugin.
- **releases/**: This folder will contain the packaged files for each plugin after they are built.
- **.github/workflows/**: Contains the GitHub Actions workflow configuration for automated builds.
- **.gitignore**: Specifies files and directories to be ignored by Git.

## Adding New Plugins

To add a new plugin:

1. Create a new directory under the `plugins/` folder.
2. Add a `package.json` file with the necessary metadata, including a `pack` script to handle the packaging process.
3. Ensure that your plugin adheres to the project's structure and conventions.

## Building Plugins

The project uses GitHub Actions to automatically build each plugin when new submissions are made. The build process will execute the `pack` script defined in each plugin's `package.json`, and the output will be placed in the `releases/` folder.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request with your changes. Make sure to follow the project's structure and guidelines.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.