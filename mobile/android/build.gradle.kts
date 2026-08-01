allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    // بعض إضافات فلاتر (file_picker مثلًا) ما زالت تُبنى على compileSdk 34، بينما
    // إضافات أخرى (flutter_plugin_android_lifecycle) تتطلب 36+. نوحّد كل الوحدات
    // الفرعية على 36 حتى ينجح فحص AAR metadata — يجب تسجيل afterEvaluate قبل
    // evaluationDependsOn حتى لا تُقيّم الوحدة قبل أن نضبطها.
    afterEvaluate {
        val androidExt = project.extensions.findByName("android")
        if (androidExt is com.android.build.gradle.BaseExtension) {
            androidExt.compileSdkVersion(36)
        }
    }
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
