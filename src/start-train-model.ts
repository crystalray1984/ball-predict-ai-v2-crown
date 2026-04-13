import { trainAndSaveModel } from './predict'

if (require.main === module) {
    trainAndSaveModel()
        .then(() => process.exit())
        .catch((err) => {
            console.error(err)
            process.exit(-1)
        })
}
